       IDENTIFICATION DIVISION.
       PROGRAM-ID. X5.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-SSN           PIC X(9).
       01 WS-MSG           PIC X(100).
       01 HCONN            PIC S9(9) BINARY.
       01 HOBJ             PIC S9(9) BINARY.
       01 MQMD             PIC X(364).
       01 MQPMO            PIC X(152).
       01 WS-LEN           PIC S9(9) BINARY VALUE 100.
       01 WS-CC            PIC S9(9) BINARY.
       01 WS-RC            PIC S9(9) BINARY.
       PROCEDURE DIVISION.
           EXEC SQL SELECT SSN INTO :WS-SSN FROM PEOPLE
                WHERE ID = 1 END-EXEC
           MOVE WS-SSN TO WS-MSG
           CALL 'MQPUT' USING HCONN HOBJ MQMD MQPMO WS-LEN WS-MSG
                WS-CC WS-RC
           GOBACK.
