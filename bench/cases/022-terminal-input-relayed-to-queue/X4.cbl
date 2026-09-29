       IDENTIFICATION DIVISION.
       PROGRAM-ID. X4.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-MSG           PIC X(100).
       01 HCONN            PIC S9(9) BINARY.
       01 HOBJ             PIC S9(9) BINARY.
       01 MQMD             PIC X(364).
       01 MQPMO            PIC X(152).
       01 WS-LEN           PIC S9(9) BINARY VALUE 100.
       01 WS-CC            PIC S9(9) BINARY.
       01 WS-RC            PIC S9(9) BINARY.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-MSG) LENGTH(WS-LEN) END-EXEC
           CALL 'MQPUT' USING HCONN HOBJ MQMD MQPMO WS-LEN WS-MSG
                WS-CC WS-RC
           GOBACK.
