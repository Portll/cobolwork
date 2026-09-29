       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALSOSRC.
      * The command line reaches WS-I unchecked; the environment reaches it only through a bound.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-A                PIC 9(4).
       01 WS-B                PIC 9(4).
       01 WS-I                PIC 9(4).
       01 WS-OUT              PIC X(10).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-A FROM COMMAND-LINE
           ACCEPT WS-B FROM ENVIRONMENT 'IDX'
           MOVE WS-A TO WS-I
           IF WS-B > 10
              DISPLAY 'BAD'
           ELSE
              MOVE WS-B TO WS-I
              MOVE WS-ENTRY(WS-I) TO WS-OUT
           END-IF
           MOVE WS-ENTRY(WS-I) TO WS-OUT
           GOBACK.
