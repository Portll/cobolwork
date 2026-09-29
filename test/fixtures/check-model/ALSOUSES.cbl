       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALSOUSES.
      * One index, three reads of one table: the report keeps the first and names the other two.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-OUT              PIC X(10).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           MOVE WS-ENTRY(WS-I) TO WS-OUT
           IF WS-I > 10
              GOBACK
           END-IF
           MOVE WS-ENTRY(WS-I) TO WS-OUT
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
